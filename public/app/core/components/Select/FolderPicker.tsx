import { css } from '@emotion/css';
import { t } from '@lingui/macro';
import { debounce } from 'lodash';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { components } from 'react-select';
import { useAsync } from 'react-use';

import { AppEvents, SelectableValue, GrafanaTheme2 } from '@grafana/data';
import { selectors } from '@grafana/e2e-selectors';
import { ActionMeta, AsyncSelect, useStyles2, InputActionMeta } from '@grafana/ui';
import appEvents from 'app/core/app_events';
import { contextSrv } from 'app/core/services/context_srv';
import { createFolder, getFolderById, searchFolders } from 'app/features/manage-dashboards/state/actions';
import { DashboardSearchHit } from 'app/features/search/types';
import { AccessControlAction, PermissionLevelString } from 'app/types';

export type FolderPickerFilter = (hits: DashboardSearchHit[]) => DashboardSearchHit[];

export interface Props {
  onChange: ($folder: { title: string; id: number }) => void;
  enableCreateNew?: boolean;
  rootName?: string;
  enableReset?: boolean;
  dashboardId?: number | string;
  initialTitle?: string;
  initialFolderId?: number;
  permissionLevel?: Exclude<PermissionLevelString, PermissionLevelString.Admin>;
  filter?: FolderPickerFilter;
  allowEmpty?: boolean;
  showRoot?: boolean;
  onClear?: () => void;
  accessControlMetadata?: boolean;
  dissalowSlashes?: boolean;
  /**
   * Skips loading all folders in order to find the folder matching
   * the folder where the dashboard is stored.
   * Instead initialFolderId and initialTitle will be used to display the correct folder.
   * initialFolderId needs to have an value > -1 or an error will be thrown.
   */
  skipInitialLoad?: boolean;
  /** The id of the search input. Use this to set a matching label with htmlFor */
  inputId?: string;
}
export type SelectedFolder = SelectableValue<number>;

const containsSlashes = (str: string): boolean => str.indexOf('/') !== -1;

const Input = (props: any) => <components.Input {...props} isHidden={false} />;

export function FolderPicker(props: Props) {
  const {
    dashboardId,
    allowEmpty,
    onChange,
    filter,
    enableCreateNew,
    inputId,
    onClear,
    enableReset,
    initialFolderId,
    initialTitle,
    permissionLevel,
    rootName,
    showRoot,
    skipInitialLoad,
    accessControlMetadata,
    dissalowSlashes,
  } = props;
  const isClearable = typeof onClear === 'function';
  const [folder, setFolder] = useState<SelectedFolder | null>(null);
  const [inputValue, setInputValue] = useState<string>('');
  const styles = useStyles2(getStyles);
  const isUsingSlashes = containsSlashes(inputValue);

  const getOptions = useCallback(
    async (query: string) => {
      const searchHits = await searchFolders(query, permissionLevel, accessControlMetadata);
      const options: Array<SelectableValue<number>> = mapSearchHitsToOptions(
        searchHits,
        Boolean(dissalowSlashes),
        filter
      );

      const hasAccess =
        contextSrv.hasAccess(AccessControlAction.DashboardsWrite, contextSrv.isEditor) ||
        contextSrv.hasAccess(AccessControlAction.DashboardsCreate, contextSrv.isEditor);

      if (hasAccess && rootName?.toLowerCase().startsWith(query.toLowerCase()) && showRoot) {
        options.unshift({ label: rootName, value: 0 });
      }

      if (
        enableReset &&
        query === '' &&
        initialTitle !== '' &&
        !options.find((option) => option.label === initialTitle)
      ) {
        options.unshift({ label: initialTitle, value: initialFolderId });
      }
      return options;
    },
    [
      enableReset,
      initialFolderId,
      initialTitle,
      permissionLevel,
      rootName,
      showRoot,
      accessControlMetadata,
      filter,
      dissalowSlashes,
    ]
  );

  const debouncedSearch = useMemo(() => {
    return debounce(getOptions, 300, { leading: true });
  }, [getOptions]);

  const loadInitialValue = async () => {
    const resetFolder: SelectableValue<number> = { label: initialTitle, value: undefined };
    const rootFolder: SelectableValue<number> = { label: rootName, value: 0 };

    const options = await getOptions('');

    let folder: SelectableValue<number> | null = null;

    if (initialFolderId !== undefined && initialFolderId !== null && initialFolderId > -1) {
      folder = options.find((option) => option.value === initialFolderId) || null;
    } else if (enableReset && initialTitle) {
      folder = resetFolder;
    } else if (initialFolderId) {
      folder = options.find((option) => option.id === initialFolderId) || null;
    }

    if (!folder && !allowEmpty) {
      if (contextSrv.isEditor) {
        folder = rootFolder;
      } else {
        // We shouldn't assign a random folder without the user actively choosing it on a persisted dashboard
        const isPersistedDashBoard = !!dashboardId;
        if (isPersistedDashBoard) {
          folder = resetFolder;
        } else {
          folder = options.length > 0 ? options[0] : resetFolder;
        }
      }
    }
    setFolder(folder);
  };

  //Keep the textbox value in line with what is selected
  useEffect(() => {
    setInputValue(folder?.label || '');
  }, [folder]);

  useEffect(() => {
    // if this is not the same as our initial value notify parent
    if (folder && folder.value !== initialFolderId) {
      onChange({ id: folder.value!, title: folder.label! });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, initialFolderId]);

  // initial values for dropdown
  useAsync(async () => {
    if (skipInitialLoad) {
      const folder = await getInitialValues({
        getFolder: getFolderById,
        folderId: initialFolderId,
        folderName: initialTitle,
      });
      setFolder(folder);
    }

    await loadInitialValue();
  }, [skipInitialLoad, initialFolderId, initialTitle]);

  const onFolderChange = useCallback(
    (newFolder: SelectableValue<number>, actionMeta: ActionMeta) => {
      if (!newFolder) {
        newFolder = { value: 0, label: rootName };
      }

      if (actionMeta.action === 'clear' && onClear) {
        onClear();
        return;
      }

      setFolder(newFolder);
      setInputValue(newFolder.label!);
      onChange({ id: newFolder.value!, title: newFolder.label! });
    },
    [onChange, onClear, rootName]
  );

  const createNewFolder = useCallback(
    async (folderName: string) => {
      if (dissalowSlashes) {
        if (containsSlashes(folderName)) {
          return false;
        }
      }
      const newFolder = await createFolder({ title: folderName });
      let folder: SelectableValue<number> = { value: -1, label: 'Not created' };

      if (newFolder.id > -1) {
        appEvents.emit(AppEvents.alertSuccess, ['Folder Created', 'OK']);
        folder = { value: newFolder.id, label: newFolder.title };

        setFolder(newFolder);
        onFolderChange(folder, { action: 'create-option', option: folder });
      } else {
        appEvents.emit(AppEvents.alertError, ['Folder could not be created']);
      }

      return folder;
    },
    [onFolderChange, dissalowSlashes]
  );

  const handleInputChange = (value: string, actionMeta: InputActionMeta) => {
    if (actionMeta.action === 'input-change') {
      setInputValue(value);
    }
  };
  return (
    <>
      <div data-testid={selectors.components.FolderPicker.containerV2}>
        {dissalowSlashes && isUsingSlashes && (
          <div className={styles.slashNotAllowed}>Folders with &apos;/&apos; character are not allowed.</div>
        )}
        <AsyncSelect
          inputId={inputId}
          aria-label={selectors.components.FolderPicker.input}
          loadingMessage={t({ id: 'folder-picker.loading', message: 'Loading folders...' })}
          defaultOptions
          defaultValue={folder}
          value={folder}
          allowCustomValue={enableCreateNew}
          loadOptions={debouncedSearch}
          onChange={onFolderChange}
          onCreateOption={createNewFolder}
          isClearable={isClearable}
          inputValue={inputValue}
          onInputChange={handleInputChange}
          components={{
            Input,
          }}
        />
      </div>
    </>
  );
}

function mapSearchHitsToOptions(hits: DashboardSearchHit[], filterSlashes: boolean, filter?: FolderPickerFilter) {
  const filteredHits = filter ? filter(hits) : hits;
  if (filterSlashes) {
    return filteredHits
      .filter((value: DashboardSearchHit) => !containsSlashes(value.title ?? ''))
      .map((hit) => ({ label: hit.title, value: hit.id }));
  } else {
    return filteredHits.map((hit) => ({ label: hit.title, value: hit.id }));
  }
}
interface Args {
  getFolder: typeof getFolderById;
  folderId?: number;
  folderName?: string;
}

export async function getInitialValues({ folderName, folderId, getFolder }: Args): Promise<SelectableValue<number>> {
  if (folderId === null || folderId === undefined || folderId < 0) {
    throw new Error('folderId should to be greater or equal to zero.');
  }

  if (folderName) {
    return { label: folderName, value: folderId };
  }

  const folderDto = await getFolder(folderId);
  return { label: folderDto.title, value: folderId };
}

const getStyles = (theme: GrafanaTheme2) => ({
  slashNotAllowed: css`
    color: ${theme.colors.warning.main};
    font-size: 12px;
    margin-bottom: 2px;
  `,
});
