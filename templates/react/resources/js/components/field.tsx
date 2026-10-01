import type { InputHTMLAttributes, ReactNode } from "react";
import InputError from "@/components/input-error";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  /** Shown to the right of the label, e.g. a "Forgot your password?" link. */
  aside?: ReactNode;
};

/** A labelled DaisyUI input with its validation message. */
export default function Field({ id, label, error, aside, className = "", ...input }: FieldProps) {
  return (
    <fieldset className="fieldset">
      <div className="flex items-center justify-between">
        <label className="label" htmlFor={id}>{label}</label>
        {aside}
      </div>
      <input id={id} name={id} className={`input w-full ${className}`} {...input} />
      <InputError message={error} />
    </fieldset>
  );
}
