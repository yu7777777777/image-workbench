const paths = {
  image: 'M3 3h18v18H3z M3 16l5-5 5 5 3-3 5 5 M15 7h.01',
  text: 'M4 5h16 M12 5v15 M8 20h8',
  generate: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  select: 'M5 3l14 10-7 1-3 7z',
  hand: 'M8 12V6a2 2 0 0 1 4 0v5 M12 10V4a2 2 0 0 1 4 0v7 M16 9V6a2 2 0 0 1 4 0v9c0 4-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2',
  fit: 'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',
  undo: 'M8 4L3 9l5 5 M3 9h11a7 7 0 0 1 7 7v4',
  redo: 'M16 4l5 5-5 5 M21 9H10a7 7 0 0 0-7 7v4',
  library: 'M3 4h5v17H3z M11 4h4v17h-4z M18 4l3 16',
  download: 'M12 3v13 M6 10l6 6 6-6 M3 18v3h18v-3',
  close: 'M6 6l12 12 M18 6L6 18',
  play: 'M7 4l14 8-14 8z',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  link: 'M10 14l4-4 M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  focus: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M4 4l5 5 M20 4l-5 5 M20 20l-5-5 M4 20l5-5',
  help: 'M9.5 9a2.5 2.5 0 1 1 4.7 1.2c-.7 1.1-2.2 1.4-2.2 3 M12 17h.01',
} as const

export function CanvasIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
