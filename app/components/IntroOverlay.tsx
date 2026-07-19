"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

const smoothEase = [0.22, 1, 0.36, 1] as const;

function IntroMark() {
  return (
    <motion.svg
      width="96"
      height="96"
      viewBox="0 0 96 96"
      role="img"
      aria-label="Photery"
      className="drop-shadow-2xl"
      initial={{ rotate: -18, scale: 0.88 }}
      animate={{ rotate: 0, scale: [0.88, 1.04, 1] }}
      transition={{ duration: 1.1, ease: smoothEase }}
    >
      <defs>
        <linearGradient id="photery-mark" x1="18" y1="16" x2="78" y2="84">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.54" stopColor="#dbe5e1" />
          <stop offset="1" stopColor="#7c9bab" />
        </linearGradient>
      </defs>
      <motion.circle
        cx="48"
        cy="48"
        r="35"
        fill="none"
        stroke="url(#photery-mark)"
        strokeWidth="2.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: smoothEase }}
      />
      <motion.path
        d="M48 23 60 44H36L48 23Z"
        fill="none"
        stroke="url(#photery-mark)"
        strokeLinejoin="round"
        strokeWidth="2.5"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16, duration: 0.42, ease: smoothEase }}
      />
      <motion.path
        d="M73 48 52 60V36L73 48Z"
        fill="none"
        stroke="url(#photery-mark)"
        strokeLinejoin="round"
        strokeWidth="2.5"
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.24, duration: 0.42, ease: smoothEase }}
      />
      <motion.path
        d="M48 73 36 52H60L48 73Z"
        fill="none"
        stroke="url(#photery-mark)"
        strokeLinejoin="round"
        strokeWidth="2.5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32, duration: 0.42, ease: smoothEase }}
      />
      <motion.path
        d="M23 48 44 36V60L23 48Z"
        fill="none"
        stroke="url(#photery-mark)"
        strokeLinejoin="round"
        strokeWidth="2.5"
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.4, duration: 0.42, ease: smoothEase }}
      />
      <circle cx="48" cy="48" r="8" fill="#b24a3b" />
    </motion.svg>
  );
}

export default function IntroOverlay() {
  const [showIntro, setShowIntro] = useState(true);

  return (
    <AnimatePresence>
      {showIntro ? (
        <motion.div
          className="fixed inset-0 z-60 grid place-items-center bg-[#111816]
            text-[#f7f8f4]"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.55 } }}
        >
          <motion.div
            className="grid place-items-center gap-4"
            initial={{ opacity: 0, scale: 0.9, filter: "blur(12px)" }}
            animate={{
              opacity: [0, 1, 1, 0],
              scale: [0.9, 1, 1.02, 1.08],
              filter: ["blur(12px)", "blur(0px)", "blur(0px)", "blur(8px)"],
            }}
            transition={{ duration: 2, times: [0, 0.24, 0.82, 1] }}
            onAnimationComplete={() => setShowIntro(false)}
          >
            <IntroMark />
            <motion.p
              className="text-sm font-bold tracking-[0.36em] text-[#dbe5e1]
                uppercase"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.5, ease: smoothEase }}
            >
              Photery
            </motion.p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
