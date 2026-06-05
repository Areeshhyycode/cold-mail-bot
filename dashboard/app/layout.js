import "./globals.css";

export const metadata = {
  title: "Cold Mail Bot — Dashboard",
  description: "AI cold email + lead finder dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
