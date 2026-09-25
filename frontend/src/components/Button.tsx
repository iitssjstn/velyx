import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-strong font-semibold',
  secondary: 'bg-raised text-ink hover:bg-line',
  ghost: 'text-muted hover:text-ink hover:bg-raised',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', icon, loading, children, className = '', disabled, type = 'button', ...rest },
  ref,
) {
  const sizes = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 gap-2', lg: 'h-12 px-6 text-lg gap-2.5' }[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizes} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
