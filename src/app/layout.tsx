import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "AccessForAll — Every voice understood",
  description: "A live accessibility companion for conferences, lectures, and meetings.",
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
