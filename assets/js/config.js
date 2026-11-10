// Configuration publique. La clé "publishable" est conçue pour le navigateur :
// tout accès réel est contrôlé côté serveur par les politiques RLS Supabase.
// La clé service_role n'apparaît JAMAIS ici (elle vit uniquement dans la fonction serveur admin-api).
export const CONFIG = {
  supabaseUrl: 'https://zcodeswjwtxilzpxtbdd.supabase.co',
  supabaseKey: 'sb_publishable_I_vfKXDNWxhVY3x3JcUfaA_jYyLEYFl',
  apartmentEmailDomain: 'apartments.4florentine.example.com',
  residentUrl: 'https://lebrati58.github.io/florentine-connect/app/',
  version: '2.0.0',
};
