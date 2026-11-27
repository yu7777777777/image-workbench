export default function CreativeLibraryLink({ className, onNavigate }: { className?: string; onNavigate: () => void }) {
  return <a className={className} href="/creative/" target="_parent" onClick={(event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onNavigate()
    window.parent.postMessage({ type: 'open-creative-library' }, window.location.origin)
  }}>创意广场</a>
}
