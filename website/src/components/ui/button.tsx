import { cva, type VariantProps } from "class-variance-authority";
import type { AnchorHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "group/btn relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,transform] duration-200 ease-out active:scale-[0.98] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-canvas hover:bg-ink-soft",
        secondary:
          "border border-hairline-strong bg-transparent text-ink hover:border-body hover:bg-white/[0.04]",
        ghost: "text-body hover:text-ink",
      },
      size: {
        sm: "h-8 px-3.5 text-[0.8125rem]",
        md: "h-10 px-5 text-sm",
        lg: "h-12 px-6 text-[0.9375rem]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> &
  VariantProps<typeof buttonVariants> & { external?: boolean };

/** Every call to action on the page is a link, so the button renders an anchor. */
export function ButtonLink({ className, variant, size, external, ...props }: ButtonLinkProps) {
  return (
    <a
      className={cn(buttonVariants({ variant, size }), className)}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      {...props}
    />
  );
}
