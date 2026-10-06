import { describe, expect, it } from 'vitest';
import { computeFinalRating, computeGoalScore, progressToRating, ratingLabel, type RatingScale } from '../../src/services/performance.service';

const scale: RatingScale = {
  min: 1,
  max: 5,
  labels: [
    { value: 1, label: 'Needs improvement' },
    { value: 2, label: 'Below expectations' },
    { value: 3, label: 'Meets expectations' },
    { value: 4, label: 'Exceeds expectations' },
    { value: 5, label: 'Outstanding' },
  ],
};

describe('performance score calculation', () => {
  it('maps progress linearly onto the scale', () => {
    expect(progressToRating(0, scale)).toBe(1);
    expect(progressToRating(100, scale)).toBe(5);
    expect(progressToRating(50, scale)).toBe(3);
    expect(progressToRating(150, scale)).toBe(5);
  });

  it('weights goal ratings, falling back to mapped progress', () => {
    // 60% × 4 (explicit rating) + 40% × 4.2 (80% progress) = 4.08
    expect(computeGoalScore([{ weight: 60, progress: 10, rating: 4 }, { weight: 40, progress: 80 }], scale)).toBe(4.08);
  });

  it('treats goals equally when none carries a weight', () => {
    expect(computeGoalScore([{ weight: 0, progress: 100 }, { weight: 0, progress: 0 }], scale)).toBe(3);
  });

  it('returns null without goals', () => {
    expect(computeGoalScore([], scale)).toBeNull();
  });

  it('blends goal score and overall rating by goal weightage', () => {
    const r = computeFinalRating({
      goals: [{ weight: 60, progress: 0, rating: 4 }, { weight: 40, progress: 80 }],
      overallRating: 4,
      goalWeightage: 60,
      scale,
    });
    // 0.6 × 4.08 + 0.4 × 4 = 4.048
    expect(r.goalScore).toBe(4.08);
    expect(r.finalRating).toBe(4.05);
    expect(r.finalRatingLabel).toBe('Exceeds expectations');
  });

  it('uses the overall rating alone when there are no goals', () => {
    const r = computeFinalRating({ goals: [], overallRating: 2.5, goalWeightage: 70, scale });
    expect(r.goalScore).toBeNull();
    expect(r.finalRating).toBe(2.5);
    // Ties resolve to the lower label.
    expect(r.finalRatingLabel).toBe('Below expectations');
  });

  it('clamps explicit ratings into the scale and supports 0% / 100% weightage', () => {
    const goals = [{ weight: 100, progress: 0, rating: 9 }];
    expect(computeFinalRating({ goals, overallRating: 2, goalWeightage: 100, scale }).finalRating).toBe(5);
    expect(computeFinalRating({ goals, overallRating: 2, goalWeightage: 0, scale }).finalRating).toBe(2);
  });

  it('returns null labels for scales without labels', () => {
    expect(ratingLabel(3, { min: 1, max: 5, labels: [] })).toBeNull();
  });
});
