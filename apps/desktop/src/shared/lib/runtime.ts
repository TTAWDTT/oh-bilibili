/** Tauri 会把启动参数挂到 window 上；浏览器预览没有这个对象，IPC 只能走内存 mock。 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
