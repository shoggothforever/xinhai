import type { SteamLibraryGame } from '../shared/coverWall'

export async function loadSteamLibrary(): Promise<SteamLibraryGame[]> {
  const key = process.env.STEAM_API_KEY?.trim()
  const steamId = process.env.STEAM_ID?.trim() || process.env.STEAM_ID64?.trim()
  if (!key || !steamId) throw Error('请在 Windows 环境变量中设置 STEAM_API_KEY 和 STEAM_ID（或 STEAM_ID64），然后重启心海')
  if (!/^\d{17}$/.test(steamId)) throw Error('Steam ID 必须是 17 位数字的 SteamID64')

  const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/')
  url.search = new URLSearchParams({ key, steamid: steamId, include_appinfo: 'true', include_played_free_games: 'true' }).toString()
  let result: { response?: { games?: unknown; game_count?: number } } | null
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
    result = response.ok ? await response.json() : null
  } catch {
    // Network errors may contain the request URL. Never forward it over IPC.
    throw Error('暂时无法连接 Steam，请稍后重试')
  }
  if (!result) throw Error('Steam 拒绝了请求，请检查 API Key 或稍后重试')
  const games = result.response?.games
  if (!Array.isArray(games)) {
    if (result.response?.game_count === 0) return []
    throw Error('Steam 没有返回游戏库，请检查 SteamID64 和游戏详情的可见性')
  }

  const library = new Map<number, SteamLibraryGame>()
  for (const game of games) {
    if (!game || !Number.isInteger(game.appid) || game.appid < 1 || game.appid > 0xffffffff) continue
    const appId = Number(game.appid)
    const name = typeof game.name === 'string' ? game.name.trim().slice(0, 1600) : ''
    const minutes = Number.isSafeInteger(game.playtime_forever) && game.playtime_forever >= 0 ? Number(game.playtime_forever) : null
    library.set(appId, {
      appId, name: name || `Steam App ${appId}`, minutes,
      cover: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
      url: `steam://nav/games/details/${appId}`
    })
  }
  return [...library.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
}
