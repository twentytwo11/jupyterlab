import { JupyterFrontEnd, IRouter } from '@jupyterlab/application';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { showDialog, Dialog, IWindowResolver } from '@jupyterlab/apputils';
import { IFileBrowserFactory, FileBrowser } from '@jupyterlab/filebrowser';
import {
  ContentsManager,
  Workspace,
  WorkspaceManager
} from '@jupyterlab/services';
import { IStateDB } from '@jupyterlab/statedb';
import { Widget } from '@lumino/widgets';
import {
  DocumentRegistry,
  ABCWidgetFactory,
  IDocumentWidget,
  DocumentWidget
} from '@jupyterlab/docregistry';

namespace CommandIDs {
  export const saveWorkspaceAsCommandId = 'workspace-ui:save-as';
  export const saveWorkspaceCommandId = 'workspace-ui:save';
}

const WORKSPACE_NAME = 'jupyterlab-workspace';
const WORKSPACE_EXT = '.' + WORKSPACE_NAME;
const LAST_SAVE_ID = 'workspace-ui:lastSave';
const ICON_NAME = 'jp-JupyterIcon';

function getDummyWidget(context: DocumentRegistry.Context): IDocumentWidget {
  const content = new Widget();
  const widget = new DocumentWidget({ content, context });
  // Dispose of the content so that it does not actually show
  content.dispose();
  return widget;
}

/**
 * This widget factory is used to handle double click on workspace
 */
class WorkspaceFactory extends ABCWidgetFactory<IDocumentWidget> {
  workspaces: WorkspaceManager;
  router: IRouter;
  state: IStateDB;

  constructor(workspaces: WorkspaceManager, router: IRouter, state: IStateDB) {
    super({
      name: 'Workspace loader',
      fileTypes: [WORKSPACE_NAME],
      defaultFor: [WORKSPACE_NAME],
      readOnly: true
    });
    this.workspaces = workspaces;
    this.router = router;
    this.state = state;
  }

  protected createNewWidget(
    context: DocumentRegistry.Context
  ): IDocumentWidget {
    // Save workspace description into jupyterlab, and navigate to it when done
    void context.ready.then(async () => {
      const workspaceDesc = (context.model.toJSON() as unknown) as Workspace.IWorkspace;
      const path = context.path;

      const workspaceId = workspaceDesc.metadata.id;
      // Upload workspace content to jupyterlab
      await this.workspaces.save(workspaceId, workspaceDesc);
      // Save last save location, for save button to work
      await this.state.save(LAST_SAVE_ID, path);
      this.router.navigate(workspaceId, { hard: true });
    });
    return getDummyWidget(context);
  }
}

/**
 * Ask user for a path to save to.
 * @param defaultPath Path already present when the dialog is shown
 */
async function getSavePath(defaultPath: string): Promise<string | null> {
  const saveBtn = Dialog.okButton({ label: 'Save' });
  const result = await showDialog({
    title: 'Save Current Workspace As...',
    body: new SaveWidget(defaultPath),
    buttons: [Dialog.cancelButton(), saveBtn]
  });
  if (result.button.label === 'Save') {
    return result.value;
  } else {
    return null;
  }
}

/**
 * A widget that gets a file path from a user.
 */
class SaveWidget extends Widget {
  constructor(path: string) {
    super({ node: createSaveNode(path) });
  }

  getValue(): string {
    return (this.node as HTMLInputElement).value;
  }
}

/**
 * Create the node for a save widget.
 */
function createSaveNode(path: string): HTMLElement {
  const input = document.createElement('input');
  input.value = path;
  return input;
}

/**
 * Save workspace to a user provided location
 */
async function save(
  userPath: string,
  contents: ContentsManager,
  data: Promise<Workspace.IWorkspace>,
  state: IStateDB
): Promise<void> {
  let name = userPath.split('/').pop();

  // Add extension if it was not proovided, or remove extention from name if it was
  if (name !== undefined && name.includes('.')) {
    name = name.split('.')[0];
  } else {
    userPath = userPath + WORKSPACE_EXT;
  }

  // Save last save location, for save button to work
  await state.save(LAST_SAVE_ID, userPath);

  const resolvedData = await data;
  resolvedData.metadata.id = '/lab/workspaces/' + name;
  await contents.save(userPath, {
    type: 'file',
    format: 'text',
    content: JSON.stringify(resolvedData)
  });
}

/**
 * Ask user for location, and save workspace. Default location is the directory opened in the file browser
 */
async function saveAs(
  browser: FileBrowser,
  contents: ContentsManager,
  data: Promise<Workspace.IWorkspace>,
  state: IStateDB
): Promise<void> {
  const lastSave = await state.fetch(LAST_SAVE_ID);

  let defaultName;
  if (lastSave === undefined) {
    defaultName = 'new-workspace';
  } else {
    defaultName = (lastSave as string)
      .split('/')
      .pop()
      ?.split('.')[0];
  }

  const defaultPath = browser.model.path + '/' + defaultName + WORKSPACE_EXT;

  return getSavePath(defaultPath).then(async userPath => {
    if (userPath !== null) {
      await save(userPath, contents, data, state);
    }
  });
}

/**
 * Initialization data for the workspace-ui extension.
 */
export namespace WorkspaceUI {
  export function activate(
    app: JupyterFrontEnd,
    menu: IMainMenu,
    fbf: IFileBrowserFactory,
    resolver: IWindowResolver,
    state: IStateDB,
    router: IRouter
  ) {
    const ft: DocumentRegistry.IFileType = {
      name: WORKSPACE_NAME,
      contentType: 'file',
      fileFormat: 'text',
      displayName: 'JupyterLab workspace File',
      extensions: [WORKSPACE_EXT],
      mimeTypes: ['text/json'],
      iconClass: ICON_NAME
    };
    app.docRegistry.addFileType(ft);

    // The workspace factory create dummy widgets for the purpose to load the new workspace.
    const factory = new WorkspaceFactory(
      app.serviceManager.workspaces,
      router,
      state
    );
    app.docRegistry.addWidgetFactory(factory);

    app.commands.addCommand(CommandIDs.saveWorkspaceAsCommandId, {
      label: 'Save Current Workspace As...',
      execute: async () => {
        const data = app.serviceManager.workspaces.fetch(resolver.name);
        await saveAs(
          fbf.defaultBrowser,
          app.serviceManager.contents,
          data,
          state
        );
      }
    });

    app.commands.addCommand(CommandIDs.saveWorkspaceCommandId, {
      label: 'Save Current Workspace',
      execute: async () => {
        const data = app.serviceManager.workspaces.fetch(resolver.name);
        const lastSave = await state.fetch('workspace-ui:lastSave');
        if (lastSave === undefined) {
          await saveAs(
            fbf.defaultBrowser,
            app.serviceManager.contents,
            data,
            state
          );
        } else {
          await save(
            lastSave as string,
            app.serviceManager.contents,
            data,
            state
          );
        }
      }
    });

    menu.fileMenu.addGroup(
      [
        {
          command: CommandIDs.saveWorkspaceAsCommandId
        },
        {
          command: CommandIDs.saveWorkspaceCommandId
        }
      ],
      40
    );
  }
}
