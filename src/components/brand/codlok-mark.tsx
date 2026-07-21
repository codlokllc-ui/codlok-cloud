type CodlokMarkProps = {
  className?: string;
  animated?: boolean;
  title?: string;
};

/** The Codlok rider mark.  The wheel markers are deliberately tiny so the
 * still mark stays clean, while motion makes the wheels feel alive. */
export function CodlokMark({ className = '', animated = false, title = 'Codlok' }: CodlokMarkProps) {
  return (
    <svg
      aria-label={title}
      className={`codlok-mark ${animated ? 'codlok-mark--animated' : ''} ${className}`}
      fill="none"
      role="img"
      viewBox="0 0 128 112"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <g className="codlok-mark__bike">
        <circle cx="31" cy="82" r="22" stroke="currentColor" strokeWidth="8" />
        <circle cx="94" cy="69" r="22" stroke="currentColor" strokeWidth="8" />
        <g className="codlok-mark__wheel codlok-mark__wheel--rear">
          <path d="M31 64v8" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
          <circle cx="31" cy="60" r="2.8" fill="currentColor" />
        </g>
        <g className="codlok-mark__wheel codlok-mark__wheel--front">
          <path d="M94 51v8" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
          <circle cx="94" cy="47" r="2.8" fill="currentColor" />
        </g>
        <circle cx="62" cy="20" r="11" fill="currentColor" />
        <path d="M43 54 55 35l18 14 23-12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="10" />
        <path d="m43 54 18 11-14 22M61 65 49 83" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="10" />
      </g>
    </svg>
  );
}
