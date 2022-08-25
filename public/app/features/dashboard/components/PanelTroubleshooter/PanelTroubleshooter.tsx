import React, { useState } from 'react';
import { connect, MapStateToProps } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { PanelPlugin } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { DashboardModel, PanelModel } from 'app/features/dashboard/state';
import { InspectTab } from 'app/features/inspector/types';
import { getPanelStateForModel } from 'app/features/panel/state/selectors';
import { StoreState } from 'app/types';

import { GetDataOptions } from '../../../query/state/PanelQueryRunner';
import { usePanelLatestData } from '../PanelEditor/usePanelLatestData';

interface OwnProps {
  dashboard: DashboardModel;
  panel: PanelModel;
}

export interface ConnectedProps {
  plugin?: PanelPlugin | null;
}

export type Props = OwnProps & ConnectedProps;

const PanelTroubleshooterUnconnected: React.FC<Props> = ({ panel, dashboard, plugin }) => {
  const [dataOptions, setDataOptions] = useState<GetDataOptions>({
    withTransforms: false,
    withFieldConfig: true,
  });

  const location = useLocation();
  const { data, isLoading, error } = usePanelLatestData(panel, dataOptions, true);
  // const metaDs = useDatasourceMetadata(data);
  // const tabs = useInspectTabs(panel, dashboard, plugin, error, metaDs);
  const defaultTab = new URLSearchParams(location.search).get('inspectTab') as InspectTab;

  const onClose = () => {
    locationService.partial({
      inspect: null,
      inspectTab: null,
    });
  };

  if (!plugin) {
    return null;
  }

  return (
    <div>HELLO!</div>
  );
};

const mapStateToProps: MapStateToProps<ConnectedProps, OwnProps, StoreState> = (state, props) => {
  const panelState = getPanelStateForModel(state, props.panel);
  if (!panelState) {
    return { plugin: null };
  }

  return {
    plugin: panelState.plugin,
  };
};

export const PanelTroubleshooter = connect(mapStateToProps)(PanelTroubleshooterUnconnected);
