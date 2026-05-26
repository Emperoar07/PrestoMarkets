import { render } from '@testing-library/react';
import { ChanceMeter } from '../ChanceMeter';

describe('ChanceMeter', () => {
  it('renders with correct percentage', () => {
    const { getByText } = render(<ChanceMeter percentage={75} />);
    expect(getByText('75%')).toBeInTheDocument();
  });

  it('renders all size variants', () => {
    const { container: smallContainer } = render(<ChanceMeter percentage={50} size="small" />);
    const { container: largeContainer } = render(<ChanceMeter percentage={50} size="large" />);

    expect(smallContainer.querySelector('svg')).toHaveAttribute('width', '60');
    expect(largeContainer.querySelector('svg')).toHaveAttribute('width', '140');
  });

  it('hides label when showLabel=false', () => {
    const { queryByText } = render(<ChanceMeter percentage={50} showLabel={false} />);
    expect(queryByText('Chance')).not.toBeInTheDocument();
  });
});
