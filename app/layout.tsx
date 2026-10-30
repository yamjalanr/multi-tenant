import './globals.css';
import Navbar from '@/components/Header/navbar';
export const metadata = { title: 'Multi Tenant notes' };

export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en">
    <body> 
      <Navbar />
      
      {children}
    </body>
    </html>
}
