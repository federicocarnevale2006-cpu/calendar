import { render } from "preact";
import "./styles.css";
import { init } from "./store";
import { App } from "./ui/App";

void init();
render(<App />, document.getElementById("app")!);
