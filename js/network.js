import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;
let channel = null;

export function initSupabase() {
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false
    }
  });
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

export async function deleteGame(gameId) {
  const { error } = await client
    .from('games')
    .delete()
    .eq('id', gameId);
  if (error) throw error;
}

export async function deleteAllOpenGames() {
  const { error } = await client
    .from('games')
    .delete()
    .like('status', 'waiting%');
  if (error) throw error;
}
