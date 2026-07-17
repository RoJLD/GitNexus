import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LensFreshnessBadge } from '../../../upstream/gitnexus-web/src/components/LensFreshnessBadge';

describe('LensFreshnessBadge', () => {
  it('renders "PÉRIMÉ" when stale is true', () => {
    render(<LensFreshnessBadge freshness={{ stale: true, age_hours: 50, ttl_hours: 24 }} />);
    expect(screen.getByText(/PÉRIMÉ/)).toBeInTheDocument();
  });

  it('does not render "PÉRIMÉ" when stale is false', () => {
    render(<LensFreshnessBadge freshness={{ stale: false, age_hours: 1, ttl_hours: 24 }} />);
    expect(screen.queryByText(/PÉRIMÉ/)).not.toBeInTheDocument();
  });

  it('renders "fraîcheur inconnue" when freshness is null (Zero-Masking)', () => {
    render(<LensFreshnessBadge freshness={null} />);
    expect(screen.getByText(/fraîcheur inconnue/)).toBeInTheDocument();
  });

  it('renders "fraîcheur inconnue" when freshness is undefined', () => {
    render(<LensFreshnessBadge freshness={undefined} />);
    expect(screen.getByText(/fraîcheur inconnue/)).toBeInTheDocument();
  });

  it('renders "fraîcheur inconnue" when stale is absent from an otherwise-present object', () => {
    render(<LensFreshnessBadge freshness={{ age_hours: 3 } as never} />);
    expect(screen.getByText(/fraîcheur inconnue/)).toBeInTheDocument();
  });

  it('includes age_hours/ttl_hours in the stale badge when both are present', () => {
    render(<LensFreshnessBadge freshness={{ stale: true, age_hours: 50, ttl_hours: 24 }} />);
    expect(screen.getByText(/50/)).toBeInTheDocument();
    expect(screen.getByText(/24/)).toBeInTheDocument();
  });
});
