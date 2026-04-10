import "./globals.css";

export const metadata = {
  title: "Watermark Studio — Professional Image Watermark Generator",
  description:
    "Add professional, diagonal, tiled watermarks to your images. Customize text, opacity, rotation, and spacing. Free, fast, and works entirely in your browser.",
  keywords: ["watermark", "image", "generator", "e-commerce", "photo protection"],
  openGraph: {
    title: "Watermark Studio",
    description: "Professional image watermark generator",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
