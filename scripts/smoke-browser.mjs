import { join } from 'node:path'

export const browserPath = process.env.CHROME_PATH || (process.platform === 'win32'
  ? join(process.env['ProgramFiles(x86)'] || process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe')
  : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
