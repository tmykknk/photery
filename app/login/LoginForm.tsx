"use client";

import { useState } from "react";
import PasswordInput from "./PasswordInput";

interface LoginFormProps {
  hasError: boolean;
}

function LoadingMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-7 w-7 animate-spin text-blue-600"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3"
      />
    </svg>
  );
}

export default function LoginForm({ hasError }: LoginFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <>
      <form
        action="/api/auth"
        method="post"
        className="space-y-4"
        onSubmit={() => setIsSubmitting(true)}
      >
        <input
          type="hidden"
          name="username"
          autoComplete="username"
          value="photery"
        />
        <PasswordInput />
        {hasError ? (
          <p className="text-xs text-red-500">パスワードが違います</p>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full cursor-pointer rounded-md bg-blue-600 p-2 text-sm
            font-medium text-white transition hover:bg-blue-700
            disabled:cursor-wait disabled:bg-blue-400"
        >
          Open Sesame!
        </button>
      </form>

      {isSubmitting ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25
            p-4 backdrop-blur-md"
        >
          <div
            className="grid w-full max-w-xs place-items-center gap-3 rounded-lg
              border border-gray-200 bg-white p-6 text-center shadow-2xl"
          >
            <LoadingMark />
            <p className="text-sm font-medium text-gray-900">Upside Down...</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
