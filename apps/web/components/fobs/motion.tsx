"use client";

// components/fobs/motion.tsx
//
// Small motion primitives shared across the app. Everything here honours
// prefers-reduced-motion (via Framer Motion's useReducedMotion): when the user
// asks for less motion we drop the transform/opacity animation and render the
// final state immediately, with no layout shift.
//
// IMPORTANT: none of these animate financial figures. Prices, balances and P&L
// are rendered final and correct by their pages; CountUp here is only for
// non-money counts (followers, ranks, trade counts).

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useReducedMotion,
  useInView,
  type Variants
} from "motion/react";

/** Fade + rise a block into view once, when it scrolls into the viewport. */
export function Reveal({
  children,
  delay = 0,
  className
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }
};

/** Stagger a list of children in. Wrap each child in <StaggerItem>. */
export function Stagger({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={listVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-40px" }}
    >
      {children}
    </motion.div>
  );
}

// NOTE: this is a standalone named export, NOT `Stagger.Item`. A compound
// component (a static property hung off another component) does not survive
// the server/client boundary — `Stagger` is imported into server components as
// a client reference proxy, so `Stagger.Item` reads back as `undefined` there
// and React throws "Element type is invalid". Export the item as its own
// component and import it directly instead.
export function StaggerItem({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}


/**
 * Count up to an integer once in view. For NON-financial counts only — never
 * wrap a price, balance or P&L in this.
 */
export function CountUp({
  value,
  className,
  durationMs = 700
}: {
  value: number;
  className?: string;
  durationMs?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(reduce ? value : 0);

  useEffect(() => {
    if (reduce || !inView) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, value, durationMs]);

  return (
    <span ref={ref} className={className}>
      {display.toLocaleString()}
    </span>
  );
}
