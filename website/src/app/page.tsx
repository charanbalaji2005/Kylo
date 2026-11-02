import { Cta } from "@/components/sections/cta";
import { Features } from "@/components/sections/features";
import { Footer } from "@/components/sections/footer";
import { Hero } from "@/components/sections/hero";
import { Install } from "@/components/sections/install";
import { Navbar } from "@/components/sections/navbar";
import { ProductDemo } from "@/components/sections/product-demo";
import { Security } from "@/components/sections/security";
import { TerminalSupport } from "@/components/sections/terminal-support";
import { Workflow } from "@/components/sections/workflow";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <ProductDemo />
        <TerminalSupport />
        <Features />
        <Security />
        <Workflow />
        <Install />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
