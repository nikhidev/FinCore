import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {title:"FinCore | Digital Wallet",description:"Simulated wallet and payment operations"};
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
