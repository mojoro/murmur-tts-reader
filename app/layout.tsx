export const metadata = {
  title: "pocket-tts",
  description: "Local text-to-speech UI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        background: "#0a0a0a",
        color: "#e0e0e0",
        fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', Menlo, monospace",
        minHeight: "100vh",
      }}>
        {children}
      </body>
    </html>
  );
}
