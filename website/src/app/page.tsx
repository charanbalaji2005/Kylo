import { Navbar } from "@/components/sections/navbar";
import { Hero } from "@/components/sections/hero";
import { Product } from "@/components/sections/product";
import { Features } from "@/components/sections/features";
import { DownloadSection } from "@/components/sections/download";
import { Footer } from "@/components/sections/footer";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-canvas">
      <Navbar />
      <main>
        <Hero />
        <Product />
        <Features />
        <DownloadSection />
      </main>
      <Footer />
    </div>
  );
}
