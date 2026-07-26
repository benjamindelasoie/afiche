import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names with conflict resolution.
 *
 * `clsx` flattens conditional/array/object class inputs; `twMerge` then
 * resolves Tailwind conflicts so a later class wins over an earlier one on
 * the same property (e.g. `cn('px-4', 'px-6')` → `'px-6'`, not both). This is
 * what lets our `_components/ui` primitives accept a `className` override that
 * predictably beats the component's own defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
