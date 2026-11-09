import React from 'react';

export const Skeleton = ({ className = '', ...props }) => {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-elevated)',
        borderColor: 'var(--border-subtle)',
      }}
      className={`animate-pulse rounded-lg border ${className}`}
      {...props}
    />
  );
};

export default Skeleton;
