import "./globals.css";

export const metadata = {
  title: "HR Policy RAG Chatbot",
  description: "Standalone Next.js HR Policy RAG Chatbot powered by Gemini",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full overflow-hidden">
      <body className="h-full overflow-hidden antialiased bg-[#F7F6F2] text-slate-900">
        {children}
      </body>
    </html>
  );
}
