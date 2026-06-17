import "./globals.css";

export const metadata = {
  title: "Sentinel AI - Monitoramento Inteligente",
  description: "Plataforma SaaS de Inteligência Artificial para Monitoramento de Veículos e Segurança Patrimonial.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
