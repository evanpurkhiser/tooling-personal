import {all} from '@evanpurkhiser/eslint-config';

export default [
  ...all,
  {
    rules: {
      'prettier/prettier': 'off',
      'simple-import-sort/imports': 'off',
      'simple-import-sort/exports': 'off',
    },
  },
];
