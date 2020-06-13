import React from "react";
import {ApolloClient, useApolloClient} from "@apollo/client";
import {StoreApi} from "zustand";
import usePatchedSubscriptions, {
  PatchData,
} from "helpers/hooks/usePatchedSubscriptions";
import {
  Entity as EntityInterface,
  EntitiesDocument,
  EntitiesQuery,
  EntityDataFragmentDoc,
  EntitiesSetPositionDocument,
  EntityCreateDocument,
} from "generated/graphql";
import {
  Scene,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  AmbientLight,
  Vector3,
  Object3D,
} from "three";
import renderer from "./renderer";
import getOrthoCamera from "./orthoCamera";
import getPerspectiveCamera from "./perspectiveCamera";
import globals from "./globals";
import Grid from "./grid";
import {css} from "@emotion/core";
import {useParams, useNavigate, NavigateFunction} from "react-router";
import gql from "graphql-tag.macro";
import {
  CanvasContext,
  CanvasContextOutput,
  canvasContextDefault,
} from "../CanvasContext";
import {distance3d} from "components/views/Sensors/gridCore/constants";
import Entity from "./entity";
import GameObjectManager from "./gameObjectManager";
import getPanControls from "./panControls";
import {clearEvents, initEvents, mouse} from "./mouseEvents";
import {get3DMousePosition} from "../use3DMousePosition";
import Nebula from "./nebula";
import {getOrbitControls} from "./orbitControls";

type OutsideState = CanvasContextOutput;

async function renderRawThreeJS(
  ref: React.RefObject<HTMLDivElement>,
  client: ApolloClient<object>,
  storeApi: StoreApi<PatchData<EntityInterface[]>>,
) {
  let outsideState: OutsideState = [canvasContextDefault, () => {}];
  let extraOutsideState: ExtraState = {
    flightId: "",
    currentStage: "",
    navigate: () => {},
  };

  const raycaster = new Raycaster();

  const gameObjectManager = new GameObjectManager();
  const scene = new Scene();
  const dimensions = ref.current?.getBoundingClientRect();

  if (!dimensions) return {updateState, cleanUp};

  renderer.setSize(dimensions.width, dimensions.height);
  // document.body.appendChild( renderer.domElement );
  // use ref as a mount point of the Three.js scene instead of the document.body
  ref.current?.appendChild(renderer.domElement);

  const nebula = new Nebula("Pretty");
  gameObjectManager.addGameObject(nebula);
  scene.add(nebula);

  const ambientLight = new AmbientLight();
  // TODO: Properly update this when outsideState changes
  ambientLight.intensity = outsideState[0].lighting ? 0.1 : 1;
  scene.add(ambientLight);

  // const wormhole = new Wormhole();
  // wormhole.position.set(0, 0, 5);
  // scene.add(wormhole);
  // gameObjectManager.addGameObject(wormhole);

  // const hyperspace = new Hyperspace();
  // hyperspace.position.set(0, 0, 5);
  // scene.add(hyperspace);
  // gameObjectManager.addGameObject(hyperspace);

  // const warp = new WarpStars();
  // gameObjectManager.addGameObject(warp);
  // scene.add(warp);

  const grid = new Grid(dimensions);
  gameObjectManager.addGameObject(grid);
  scene.add(grid);

  const orthoCamera = getOrthoCamera(dimensions);
  const perspectiveCamera = getPerspectiveCamera(dimensions);
  let activeCamera: PerspectiveCamera | OrthographicCamera = orthoCamera;

  const panControls = getPanControls(orthoCamera, ref.current);
  const orbitControls = getOrbitControls(perspectiveCamera, ref.current);
  orbitControls.enabled = false;
  initEvents(ref.current);

  let mousePosition = new Vector3();
  let isMouseDown = false;
  let mouseDownTime = 0;
  let clickCount = 0;
  document.addEventListener("mousedown", e => {
    if (e.target !== renderer.domElement) return;
    isMouseDown = true;
    if (Date.now() - mouseDownTime > 500) {
      clickCount = 0;
    }

    clickCount = clickCount + 1;
    mouseDownTime = Date.now();

    if (activeCamera !== orthoCamera) return;
    // update the picking ray with the camera and mouse position
    raycaster.setFromCamera(mouse, orthoCamera);

    // calculate objects intersecting the picking ray
    const intersects = raycaster.intersectObjects(scene.children, true);
    const intersectedObject = intersects.find(o => {
      if (!o.object) return false;
      if (o.object.parent instanceof Entity) {
        return o.object.parent.visible;
      } else {
        return o.object.visible;
      }
    });
    if (intersectedObject?.object) {
      const id = intersectedObject.object.uuid;
      if (gameObjectManager.gameObjects.find(g => g.uuid === id)) {
        outsideState[1]({
          type: "selected",
          selected: e.shiftKey ? outsideState[0].selected.concat(id) : [id],
        });
        panControls.enabled = false;
      } else {
        outsideState[1]({
          type: "selected",
          selected: [],
        });
        panControls.enabled = true;
      }
    }
  });
  document.addEventListener("mousemove", e => {
    const addingEntity = outsideState[0].addingEntity;
    if (activeCamera !== orthoCamera) return;
    const position = get3DMousePosition(
      e.clientX - dimensions.left,
      e.clientY - dimensions.top,
      dimensions.width,
      dimensions.height,
      orthoCamera,
    );
    mousePosition = position;
    if (!isMouseDown && !addingEntity) return;
    if (outsideState[0].selected.length > 0) {
      gameObjectManager.gameObjects.forEach(object => {
        if (outsideState[0].selected.includes(object.uuid)) {
          object.position.set(position.x, position.y, position.z);
        }
      });
    }
    if (addingEntity) {
      const entity = gameObjectManager.gameObjects.find(
        g => g.uuid === addingEntity.id,
      );
      if (entity) {
        entity.position.set(position.x, position.y, position.z);
      }
    }
  });
  document.addEventListener("mouseup", e => {
    isMouseDown = false;
    if (activeCamera !== orthoCamera) return;
    panControls.enabled = true;

    if (
      clickCount >= 2 &&
      Date.now() - mouseDownTime <= 500 &&
      outsideState[0].selected[0]
    ) {
      // Double click handler
      extraOutsideState.navigate(
        `/config/sandbox/${outsideState[0].selected[0]}`,
      );
      return;
    }

    if (outsideState[0].selected.length > 1) {
      // Send an update with the new positions
      const entities = gameObjectManager.gameObjects
        .filter(object => {
          if (outsideState[0].selected.includes(object.uuid)) {
            return true;
          }
          return false;
        })
        .map(e => ({id: e.uuid, position: e.position}));
      client.mutate({
        mutation: EntitiesSetPositionDocument,
        variables: {entities},
      });
    }

    // Create a new entity when dropped on the canvas
    const addingEntity = outsideState[0].addingEntity;
    if (addingEntity) {
      const entity = gameObjectManager.gameObjects.find(
        g => g.uuid === addingEntity.id,
      ) as EntityInterface | undefined;
      if (entity) {
        const variables = {
          flightId: extraOutsideState.flightId,
          stageParentId: extraOutsideState.currentStage,
          position: mousePosition,
          name: entity.identity?.name,
          meshType: entity.appearance?.meshType,
          color: entity.appearance?.color,
          emissiveColor: entity.appearance?.emissiveColor,
          emissiveIntensity: entity.appearance?.emissiveIntensity,
          modelAsset: entity.appearance?.modelAsset,
          materialMapAsset: entity.appearance?.materialMapAsset,
          ringMapAsset: entity.appearance?.ringMapAsset,
          cloudMapAsset: entity.appearance?.cloudMapAsset,
          glowColor: entity.glow?.color,
          glowMode: entity.glow?.glowMode,
          lightColor: entity.light?.color,
          lightDecay: entity.light?.decay,
          lightIntensity: entity.light?.intensity,
        };

        client
          .mutate({
            mutation: EntityCreateDocument,
            variables,
          })
          .then(res => {
            if (res.data?.entityCreate.id) {
              outsideState[1]({
                type: "selected",
                selected: [res.data.entityCreate.id],
              });
            }
          });
      }
    }

    // Clear out any adding entities
    outsideState[1]({type: "addingEntity", addingEntity: null});
  });

  let then = 0;
  let frame: number;

  // TODO: Properly update objects
  function handleEntities(storeApi: StoreApi<PatchData<EntityInterface[]>>) {
    const addList: {[key: string]: EntityInterface} = {};
    const updateList: {[key: string]: EntityInterface} = {};
    let entities = storeApi.getState().data;
    for (let i = 0; i < entities.length; i++) {
      if (entities[i]) {
        if (
          gameObjectManager.gameObjects.find((e: Object3D) => {
            return e.uuid === entities[i].id;
          })
        ) {
          updateList[entities[i].id] = entities[i];
        } else {
          addList[entities[i].id] = entities[i];
        }
      }
    }
    Object.values(addList).forEach(e => {
      const entity = new Entity(e as EntityInterface);
      gameObjectManager.addGameObject(entity);
      scene.add(entity);
    });
    Object.values(updateList).forEach(e => {
      const entity = gameObjectManager.gameObjects.find(g => g.uuid === e.id);
      if (entity instanceof Entity) {
        entity.updateObject(e);
      }
    });
    gameObjectManager.gameObjects.forEach(e => {
      if (
        e instanceof Entity &&
        !e.location?.inert &&
        e.uuid !== outsideState[0].addingEntity?.id &&
        !Object.keys(addList).includes(e.uuid) &&
        !Object.keys(updateList).includes(e.uuid)
      ) {
        gameObjectManager.removeGameObject(e);
        scene.remove(e);
      }
    });
  }

  const render = function (now: number) {
    globals.time = now;
    globals.delta = Math.min(globals.time - then, 1 / 20);
    then = globals.time;

    frame = requestAnimationFrame(render);

    try {
      // Update the orbit controls if necessary
      if (activeCamera === perspectiveCamera) {
        orbitControls.update();
      }
      gameObjectManager.update({
        camera: activeCamera,
        delta: globals.delta,
        currentStage: extraOutsideState.currentStage,
      });
      handleEntities(storeApi);
    } catch (err) {
      console.error("There has been an error", err);
      cancelAnimationFrame(frame);
      throw err;
    }

    renderer.render(scene, activeCamera);
  };
  frame = requestAnimationFrame(render);

  const maxSize = Math.max(
    renderer.domElement.width,
    renderer.domElement.height,
  );

  // const light = new LensFlare(0xffffff, 1.5, 2000);
  // light.position.set(0, 0, -500);
  // scene.add(light);

  function updateState(state: CanvasContextOutput, extraState: ExtraState) {
    const contextState = state[0];

    // Handle the extra state first
    if (extraState.flightId !== extraOutsideState.flightId) {
      // Remove the old ones
      gameObjectManager.gameObjects.forEach(g => {
        if (g instanceof Entity) {
          if (g.flightId === extraOutsideState.flightId) {
            gameObjectManager.removeGameObject(g);
          }
        }
      });

      // Add any new ones
      client
        .query({
          query: EntitiesDocument,
          variables: {flightId: extraState.flightId},
        })
        .then(res => {
          const entities: EntitiesQuery = res.data;

          // Get the root stage ID. We can assume that we can change the root stage ID because this will
          // only run if the flight ID is changed, so we should revert back to the root stage if the
          // current stage ID doesn't exist.
          const rootStageId = entities?.entities?.find(e => e?.stage?.rootStage)
            ?.id;
          const currentStage = entities?.entities?.find(
            e => e?.id === extraState.currentStage,
          );
          if (
            !currentStage &&
            rootStageId &&
            extraOutsideState.currentStage !== rootStageId
          ) {
            extraOutsideState.navigate(`/config/sandbox/${rootStageId}`);
          }
          entities?.entities?.forEach(e => {
            if (!e) return;
            const entity = new Entity(e as EntityInterface);
            gameObjectManager.addGameObject(entity);
            scene.add(entity);
          });
        });
    }
    // Hide any objects that aren't on this stage.

    extraOutsideState = extraState;

    // Imperative functions to make the THREEJS objects reflect the state
    if (contextState.selecting) {
      panControls.mouseButtons = {
        MIDDLE: MOUSE.DOLLY,
        LEFT: MOUSE.ROTATE,
        RIGHT: MOUSE.PAN,
      };
    } else {
      panControls.mouseButtons = {
        MIDDLE: MOUSE.DOLLY,
        LEFT: MOUSE.PAN,
        RIGHT: MOUSE.PAN,
      };
    }
    if (outsideState[0].recenter !== contextState.recenter) {
      if (activeCamera === orthoCamera) {
        activeCamera.position.set(0, 0, 1 / 0.0000000001);
        const radius = gameObjectManager.gameObjects.reduce((prev, next) => {
          if (!next.visible) return prev;
          const distance = distance3d({x: 0, y: 0, z: 0}, next.position);
          if (distance > prev) return distance;
          return prev;
        }, 0);
        if (radius !== 0) {
          panControls.reset();
          const newZoom = 1 / ((radius * 2) / maxSize) / 100;
          panControls.zoom0 = newZoom;
          activeCamera.position.set(0, 0, 1 / 0.0000000001);
          activeCamera.updateProjectionMatrix();
        }
      }
    }
    if (outsideState[0].camera !== contextState.camera) {
      if (contextState.camera) {
        activeCamera = perspectiveCamera;
        grid.visible = false;
        nebula.visible = true;
        panControls.enabled = false;
        orbitControls.enabled = true;
      } else {
        activeCamera = orthoCamera;
        grid.visible = true;
        nebula.visible = false;
        panControls.enabled = true;
        orbitControls.enabled = false;
      }
    }
    if (outsideState[0].skyboxKey !== contextState.skyboxKey) {
      nebula.generate(outsideState[0].skyboxKey);
    }

    // Show selection
    gameObjectManager.gameObjects.forEach(obj => {
      if (contextState.selected.includes(obj.uuid)) {
        if (obj.selected === false) {
          obj.selected = true;
        }
      } else if (obj.selected === true) {
        obj.selected = false;
      }
    });

    // Add any entities which are currently being dragged onto the canvas
    if (!outsideState[0].addingEntity && state[0].addingEntity) {
      const e = state[0].addingEntity;
      const entity = new Entity({
        ...e,
        stageChild: {
          parentId: extraState.currentStage,
        },
        location: {
          position: mousePosition,
          velocity: {x: 0, y: 0, z: 0},
          acceleration: {x: 0, y: 0, z: 0},
          rotation: {x: 0, y: 0, z: 0, w: 1},
          rotationAcceleration: {x: 0, y: 0, z: 0},
          rotationVelocity: {x: 0, y: 0, z: 0},
          inert: false,
        },
      });
      gameObjectManager.addGameObject(entity);
      scene.add(entity);
    }
    // Remove any entities which were being dragged onto the canvas
    if (outsideState[0].addingEntity && !state[0].addingEntity) {
      const gameObject = gameObjectManager.gameObjects.find(
        g => g.uuid === outsideState[0].addingEntity?.id,
      );
      if (gameObject) {
        gameObjectManager.removeGameObject(gameObject);
        scene.remove(gameObject);
      }
    }

    outsideState = state;
  }
  function cleanUp() {
    cancelAnimationFrame(frame);
    doDispose(scene);
    panControls.dispose();
    clearEvents(ref.current);
  }
  return {updateState, cleanUp};
}

function doDispose(obj: any) {
  if (obj !== null) {
    for (var i = 0; i < obj.children.length; i++) {
      doDispose(obj.children[i]);
    }
    if (obj.geometry) {
      obj.geometry.dispose();
      obj.geometry = undefined;
    }
    if (obj.material) {
      if (obj.material.map) {
        obj.material.map.dispose();
        obj.material.map = undefined;
      }
      obj.material.dispose();
      obj.material = undefined;
    }
  }
  obj = undefined;
}

const sub = gql`
  subscription Entities($flightId: ID!, $stageId: ID!) {
    entities(flightId: $flightId, stageId: $stageId, template: false) {
      ...EntityData
    }
  }
  ${EntityDataFragmentDoc}
`;

interface ExtraState {
  flightId: string;
  currentStage: string;
  navigate: NavigateFunction;
}

const RawTHREEJS: React.FC = () => {
  const {stageId: currentStage = "root-stage"} = useParams();
  const navigate = useNavigate();
  const flightId = "cool flight";

  const [, storeApi] = usePatchedSubscriptions<
    EntityInterface[],
    {flightId: string; stageId: string}
  >(sub, {flightId, stageId: currentStage});
  const client = useApolloClient();

  const threeRef = React.useRef<HTMLDivElement>(null);

  const updateStateCallback = React.useRef(
    (state: CanvasContextOutput, extraState: ExtraState) => {},
  );
  const outsideState = React.useContext(CanvasContext);
  React.useLayoutEffect(() => {
    let cleanup = () => {};
    renderRawThreeJS(threeRef, client, storeApi).then(
      ({updateState, cleanUp}) => {
        cleanup = cleanUp;
        updateStateCallback.current = updateState;
        updateState(outsideState, {flightId, currentStage, navigate});
      },
    );
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useLayoutEffect(() => {
    updateStateCallback.current(outsideState, {
      flightId,
      currentStage,
      navigate,
    });
  });
  return (
    <div
      ref={threeRef}
      css={css`
        canvas {
          width: 100%;
          height: 100%;
        }
      `}
    />
  );
};

export default RawTHREEJS;
