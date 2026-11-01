interface BrandFlightLogoProps {
  variant?: 'header' | 'auth' | 'verification'
  showDescriptor?: boolean
}

export default function BrandFlightLogo({
  variant = 'header',
  showDescriptor = true,
}: BrandFlightLogoProps) {
  return (
    <div
      className={`bf-brand-lockup bf-brand-lockup--${variant}`}
      role="img"
      aria-label={showDescriptor ? 'BrandFlight — Content Preflight' : 'BrandFlight'}
    >
      <span className="bf-logo-mark" aria-hidden="true">
        <img className="bf-logo-symbol" src="/brandflight-mark.svg" alt="" />
      </span>
      <span className="bf-brand-copy">
        <span className="bf-wordmark">
          <span className="bf-wordmark-brand">Brand</span><span className="bf-wordmark-flight">Flight</span>
        </span>
        {showDescriptor && <span className="bf-product-Descriptor">Content Preflight</span>}
      </span>
    </div>
  )
}
