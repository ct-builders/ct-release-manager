/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import {
  type TI18NImportData,
  type TMessageTranslations,
  parseChunkImport,
} from '@commercetools-frontend/i18n';

const getChunkImport = (locale: string): Promise<TI18NImportData> => {
  switch (locale) {
    default:
      return import(
        /* webpackChunkName: "app-i18n-en" */
        './i18n/data/en.json'
      );
  }
};

const loadMessages = async (locale: string): Promise<TMessageTranslations> => {
  try {
    const chunkImport = await getChunkImport(locale);
    return parseChunkImport(chunkImport);
  } catch (error) {
    console.warn(
      `Something went wrong while loading the app messages for ${locale}`,
      error
    );
    return {};
  }
};

export default loadMessages;
