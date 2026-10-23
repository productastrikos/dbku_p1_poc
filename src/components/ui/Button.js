import React from 'react';
import Icon from './Icon';

/**
 * Button
 *   variant: 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger' | 'accent'
 *   size:    'sm' | 'md' | 'lg'
 *   icon:    icon name placed before the label
 *   block:   full width
 * One primary per view; everything else is secondary, ghost or soft (spec §7.6 in theme.css).
 */
export default function Button({
  variant = 'primary', size = 'md', icon, block = false,
  className = '', type = 'button', children, ...props
}) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size !== 'md' && `btn-${size}`,
    block && 'btn-block',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button type={type} className={classes} {...props}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

// Square icon-only button, used in toolbars and for close buttons.
export function IconButton({ icon, label, active = false, plain = false, className = '', children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${plain ? 'icon-btn-plain' : ''} ${active ? 'is-active' : ''} ${className}`}
      {...props}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}
