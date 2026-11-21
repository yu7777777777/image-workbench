
import { createRoot } from 'react-dom/client'
import { ImageAnnotatorModal } from './src/components/ImageAnnotatorModal'
import { storeImage } from './src/lib/db'
import './src/index.css'
async function main() {
  const c = document.createElement('canvas'); c.width=1254; c.height=1254
  const x = c.getContext('2d')!
  x.fillStyle='#22c55e'; x.fillRect(0,0,1254,1254)
  x.fillStyle='#fff'; x.font='bold 80px system-ui'; x.textAlign='center'; x.textBaseline='middle'
  x.fillText('1254', 627, 627)
  const id = await storeImage(c.toDataURL('image/png'), 'upload')
  createRoot(document.getElementById('root')!).render(<ImageAnnotatorModal imageId={id} onClose={()=>{}} onApply={()=>{}} />)
}
void main()
