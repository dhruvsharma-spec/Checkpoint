import { redirect } from 'next/navigation';

// There is no home page: signing in, and the logo, land on the CCB page.
export default function Home() { redirect('/ccb'); }
