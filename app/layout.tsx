import './globals.css';
export const metadata = { title: 'Tenant notes' };
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
