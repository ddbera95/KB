import { createReactBlockSpec } from '@blocknote/react';
import { defaultProps } from '@blocknote/core';

export type CalloutType = 'info' | 'warning' | 'tip' | 'danger' | 'note';

export const CALLOUT_STYLES: Record<CalloutType, { icon: string; color: string; bg: string; label: string }> = {
  info:    { icon: 'ℹ️',  color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  label: 'Info'    },
  warning: { icon: '⚠️',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'Warning' },
  tip:     { icon: '💡',  color: '#10b981', bg: 'rgba(16,185,129,0.1)', label: 'Tip'     },
  danger:  { icon: '🚨',  color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  label: 'Danger'  },
  note:    { icon: '📝',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', label: 'Note'    },
};

export const CalloutBlock = createReactBlockSpec(
  {
    type: 'callout' as const,
    propSchema: {
      ...defaultProps,
      calloutType: {
        default: 'info' as CalloutType,
        values: ['info', 'warning', 'tip', 'danger', 'note'] as const,
      },
    },
    content: 'inline',
  },
  {
    render: ({ block, contentRef }) => {
      const style = CALLOUT_STYLES[block.props.calloutType as CalloutType] ?? CALLOUT_STYLES.info;
      return (
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: '10px 14px',
            background: style.bg,
            borderRadius: 8,
            borderLeft: `3px solid ${style.color}`,
            margin: '2px 0',
          }}
        >
          <span style={{ fontSize: 18, lineHeight: '1.6', flexShrink: 0, userSelect: 'none' }}>
            {style.icon}
          </span>
          <div ref={contentRef} style={{ flex: 1, lineHeight: 1.7, color: 'var(--text-primary, #e5e5e5)' }} />
        </div>
      );
    },
  }
);
