import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';

const data = [{ name: 'days', days: 10 }];
const el = React.createElement(RadialBarChart, {
  data, innerRadius: '76%', outerRadius: '100%', startAngle: 90, endAngle: -270, barSize: 10, width: 104, height: 104
},
  React.createElement(PolarAngleAxis, { type: 'number', domain: [0, 12], tick: false, axisLine: false }),
  React.createElement(RadialBar, { dataKey: 'days', fill: 'var(--complete)', background: true, cornerRadius: 6, isAnimationActive: false })
);

console.log(renderToStaticMarkup(el));
