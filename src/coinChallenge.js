export const COIN_CHALLENGE_ATTEMPTS = 3;

export const COIN_LANES = [
  {
    id: 'lower',
    label: '下方金幣',
    description: '較低的弧線，適合用中等投擲角度挑戰。',
    color: '#f0ae36',
    startX: 8,
    endX: 50,
    baseY: 2.55,
    peakY: 6.35,
    count: 8
  },
  {
    id: 'upper',
    label: '上方金幣',
    description: '較高的弧線，需要較大的角度或力道。',
    color: '#ffd86b',
    startX: 8,
    endX: 50,
    baseY: 4.85,
    peakY: 9.25,
    count: 8
  }
];

export const COIN_TARGETS = COIN_LANES.flatMap(lane => (
  Array.from({ length: lane.count }, (_, index) => {
    const progress = index / (lane.count - 1);
    const arc = 4 * progress * (1 - progress);
    return {
      id: `${lane.id}-${index + 1}`,
      lane: lane.id,
      label: lane.label,
      color: lane.color,
      x: lane.startX + (lane.endX - lane.startX) * progress,
      y: lane.baseY + (lane.peakY - lane.baseY) * arc,
      z: 0,
      index: index + 1
    };
  })
));

