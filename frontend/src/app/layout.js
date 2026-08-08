import "./globals.css";

export const metadata = {
  title: "Sentinel AI - Monitoramento Inteligente",
  description: "Plataforma SaaS de Inteligência Artificial para Monitoramento de Veículos e Segurança Patrimonial.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sentinel AI",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta name="theme-color" content="#4f46e5" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/logo.jpg" />
      </head>
      <body>{children}</body>
    </html>
  );
}
