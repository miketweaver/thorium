import React from "react";
import StorybookWrapper from "./helpers/storybookWrapper.js";

import baseProps from "./helpers/baseProps.js";
import Component from "../components/views/Macros/index.js";

export default {
  title: "Cards|Macros",
};
export const Macros = () => (
  <StorybookWrapper>
    <Component {...baseProps} />
  </StorybookWrapper>
);
