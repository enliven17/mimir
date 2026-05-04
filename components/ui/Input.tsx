"use client";

import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  mono?: boolean;
  dot?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, mono, dot, className = "", ...props }, ref) => {
    return (
      <div>
        {label && (
          <label className="label">
            {dot && (
              <span
                className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                style={{ background: dot }}
              />
            )}
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`input ${mono ? "font-mono text-xs" : ""} ${className}`}
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
