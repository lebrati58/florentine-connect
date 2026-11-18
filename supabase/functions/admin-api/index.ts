// 4FLORENTINE · admin-api (Supabase Edge Function, Deno)
// Opérations qui exigent la clé service_role, qui ne quitte jamais le serveur :
//  - apartment_set_pin : crée le compte d'un appartement ou remet son code
//                        (code de porte du bâtiment + n° d'appartement, sinon PIN aléatoire ;
//                        révoque alors toutes les sessions ouvertes)
//  - apartments_apply_door_codes : fait la même chose pour tous les appartements actifs
//  - apartment_disable : bloque l'accès d'un appartement
//  - staff_create      : crée un compte équipe avec mot de passe temporaire (propriétaire uniquement)
// L'appelant est authentifié par son JWT ; son rôle est relu dans public.staff.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APARTMENT_EMAIL_DOMAIN = Deno.env.get("APARTMENT_EMAIL_DOMAIN") ?? "apartments.4florentine.example.com";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://lebrati58.github.io,http://localhost:8811").split(",");

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function apartmentEmail(towerId: number, number: string) {
  return `apt-${towerId}-${number.toLowerCase()}@${APARTMENT_EMAIL_DOMAIN}`;
}

const WEAK = new Set(["123456", "654321", "111111", "000000", "121212", "123123", "112233"]);
function generatePin(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const pin = String(buf[0] % 1_000_000).padStart(6, "0");
    if (!WEAK.has(pin) && !/^(\d)\1{5}$/.test(pin)) return pin;
  }
}
// Code de porte par bâtiment, lu dans public.tower_door_codes (service_role uniquement).
async function doorCodes(): Promise<Map<number, string>> {
  const { data, error } = await admin.from("tower_door_codes").select("tower_id, door_code");
  if (error) throw error;
  return new Map((data ?? []).map((r) => [Number(r.tower_id), String(r.door_code)]));
}
function pinFor(apt: { tower_id: number; number: string }, codes: Map<number, string>): string {
  const door = codes.get(Number(apt.tower_id));
  return door ? door + String(apt.number).trim() : generatePin();
}

type Apt = { id: number; tower_id: number; number: string; user_id: string | null };
// Crée le compte de l'appartement ou remplace son code (et révoque les sessions si demandé).
async function setApartmentPin(apt: Apt, pin: string, revoke: boolean) {
  let userId = apt.user_id;
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password: pin, ban_duration: "none" });
    if (error) throw error;
    if (revoke) await admin.rpc("revoke_user_sessions", { p_user: userId });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: apartmentEmail(apt.tower_id, apt.number),
      password: pin,
      email_confirm: true,
      app_metadata: { kind: "apartment", apartment_id: apt.id },
    });
    if (error) throw error;
    userId = data.user.id;
  }
  const { error: upErr } = await admin.from("apartments")
    .update({ user_id: userId, pin_set_at: new Date().toISOString() }).eq("id", apt.id);
  if (upErr) throw upErr;
}

function generatePassword(): string {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "x");
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get("origin")), "Content-Type": "application/json" };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return reply(401, { error: "not_authenticated" });

  const { data: me } = await admin.from("staff").select("role, active").eq("user_id", who.user.id).maybeSingle();
  if (!me?.active) return reply(403, { error: "forbidden" });
  const isManager = me.role === "owner" || me.role === "manager";

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "bad_json" }); }

  try {
    switch (body.action) {
      case "apartment_set_pin": {
        if (!isManager) return reply(403, { error: "forbidden" });
        const id = Number(body.apartment_id);
        const { data: apt } = await admin.from("apartments").select("id, tower_id, number, user_id, active").eq("id", id).maybeSingle();
        if (!apt) return reply(404, { error: "apartment_not_found" });
        if (!apt.active) return reply(409, { error: "apartment_inactive" });
        const pin = pinFor(apt, await doorCodes());
        await setApartmentPin(apt as Apt, pin, true);
        // Le PIN n'est stocké nulle part en clair (haché par Supabase Auth).
        return reply(200, { pin, tower_id: apt.tower_id, number: apt.number });
      }

      case "apartments_apply_door_codes": {
        if (!isManager) return reply(403, { error: "forbidden" });
        const codes = await doorCodes();
        if (!codes.size) return reply(409, { error: "no_door_codes" });
        const { data: apts, error } = await admin.from("apartments")
          .select("id, tower_id, number, user_id, pin_set_at").eq("active", true).order("tower_id").order("number");
        if (error) throw error;
        // On ne réactive pas un appartement dont l'accès a été coupé (compte existant sans code).
        const todo = (apts ?? []).filter((a) => codes.has(Number(a.tower_id)) && !(a.user_id && !a.pin_set_at)) as Apt[];
        let done = 0;
        const failed: string[] = [];
        for (let i = 0; i < todo.length; i += 8) {
          await Promise.all(todo.slice(i, i + 8).map(async (a) => {
            try { await setApartmentPin(a, pinFor(a, codes), false); done++; }
            catch (e) { console.error(a.tower_id, a.number, e); failed.push(`${a.tower_id}-${a.number}`); }
          }));
        }
        return reply(200, { done, failed, skipped: (apts ?? []).length - todo.length });
      }

      case "apartment_disable": {
        if (!isManager) return reply(403, { error: "forbidden" });
        const { data: apt } = await admin.from("apartments").select("id, user_id").eq("id", Number(body.apartment_id)).maybeSingle();
        if (!apt) return reply(404, { error: "apartment_not_found" });
        if (apt.user_id) {
          await admin.auth.admin.updateUserById(apt.user_id, { ban_duration: "876000h" });
          await admin.rpc("revoke_user_sessions", { p_user: apt.user_id });
        }
        await admin.from("apartments").update({ pin_set_at: null }).eq("id", apt.id);
        return reply(200, { ok: true });
      }

      case "staff_create": {
        if (me.role !== "owner") return reply(403, { error: "forbidden" });
        const email = String(body.email ?? "").trim().toLowerCase();
        const fullName = String(body.full_name ?? "").trim();
        const role = String(body.role ?? "");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.endsWith("@" + APARTMENT_EMAIL_DOMAIN)) {
          return reply(400, { error: "bad_email" });
        }
        if (fullName.length < 2 || !["owner", "manager", "technician", "viewer"].includes(role)) {
          return reply(400, { error: "bad_input" });
        }
        const password = generatePassword();
        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, app_metadata: { kind: "staff" },
        });
        if (error) throw error;
        const { error: insErr } = await admin.from("staff").insert({ user_id: data.user.id, full_name: fullName, role });
        if (insErr) { await admin.auth.admin.deleteUser(data.user.id); throw insErr; }
        return reply(200, { email, temporary_password: password });
      }

      default:
        return reply(400, { error: "unknown_action" });
    }
  } catch (e) {
    console.error(e);
    return reply(500, { error: "server_error", detail: (e as Error).message });
  }
});
