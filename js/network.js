import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;
let channel = null;

export function initSupabase() {
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export async function createGame(gameId) {
  const { error } = await client.from('games').insert({ id: gameId });
  if (error) throw error;
}

export async function fetchGame(gameId) {
  const { data, error } = await client
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function sendMove(gameId, moves, status) {
  const { error } = await client
    .from('games')
    .update({ moves, status })
    .eq('id', gameId);
  if (error) throw error;
}

export async function joinGame(gameId) {
  const { error } = await client
    .from('games')
    .update({ status: 'active' })
    .eq('id', gameId);
  if (error) throw error;
}

export function subscribeToGame(gameId, onUpdate) {
  channel = client
    .channel(`game-${gameId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gameId}`,
      },
      (payload) => onUpdate(payload.new)
    )
    .subscribe();
}

export function unsubscribe() {
  if (channel) {
    client.removeChannel(channel);
    channel = null;
  }
}

// --- Auth ---

export async function signUpUser(username, password) {
  const email = `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@example.com`;
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });
  if (error) throw error;
  return data;
}

export async function signInUser(username, password) {
  const email = `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@example.com`;
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

export async function signOutUser() {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function getCurrentSession() {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function fetchOpenGames() {
  // Query games where status starts with 'waiting'
  const { data, error } = await client
    .from('games')
    .select('*')
    .like('status', 'waiting%')
    .limit(30);
  if (error && error.code !== 'PGRST116') throw error;
  return data || [];
}
