import {all} from '@evanpurkhiser/eslint-config';

export default [
  ...all,
  {
    rules: {
      'prettier/prettier': 'off',
    },
  },
];
