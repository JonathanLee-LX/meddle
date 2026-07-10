export interface FilePickerFileHandle {
  getFile: () => Promise<File>
}

export interface OpenFilePickerOptions {
  types?: Array<{
    description?: string
    accept: Record<string, string[]>
  }>
  multiple?: boolean
}

export interface OpenFilePickerWindow extends Window {
  showOpenFilePicker: (options?: OpenFilePickerOptions) => Promise<FilePickerFileHandle[]>
}

export function supportsOpenFilePicker(win: Window): win is OpenFilePickerWindow {
  return 'showOpenFilePicker' in win
}
