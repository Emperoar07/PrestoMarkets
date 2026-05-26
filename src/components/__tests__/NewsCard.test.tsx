import { render } from '@testing-library/react';
import { NewsCard } from '../NewsCard';

describe('NewsCard', () => {
  const defaultProps = {
    id: 'test-market',
    title: 'Test Market Title',
    yesPercentage: 65,
    noPercentage: 35,
    closeDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
    volume: '$12.5K',
    category: 'Tech',
    type: 'Prediction' as const,
  };

  it('renders with title and odds', () => {
    const { getByText } = render(<NewsCard {...defaultProps} />);
    expect(getByText('Test Market Title')).toBeInTheDocument();
    expect(getByText('YES 65%')).toBeInTheDocument();
    expect(getByText('NO 35%')).toBeInTheDocument();
  });

  it('renders image when provided', () => {
    const { getByAltText } = render(
      <NewsCard {...defaultProps} imageURI="https://example.com/image.png" />
    );
    expect(getByAltText('Test Market Title')).toBeInTheDocument();
  });

  it('renders market type badge with correct emoji', () => {
    const { getByText: getByTextPrediction } = render(
      <NewsCard {...defaultProps} imageURI="https://example.com/test-image.png" type="Prediction" />
    );
    expect(getByTextPrediction(/📊.*Prediction/)).toBeInTheDocument();

    const { getByText: getByTextOpinion } = render(
      <NewsCard {...defaultProps} imageURI="https://example.com/test-image.png" type="Opinion" />
    );
    expect(getByTextOpinion(/💬.*Opinion/)).toBeInTheDocument();

    const { getByText: getByTextOpportunity } = render(
      <NewsCard {...defaultProps} imageURI="https://example.com/test-image.png" type="Opportunity" />
    );
    expect(getByTextOpportunity(/🚀.*Opportunity/)).toBeInTheDocument();
  });
});
