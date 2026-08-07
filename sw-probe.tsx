import { renderToStaticMarkup } from "react-dom/server";
import { Switch } from "@/components/ui/switch";

console.log(renderToStaticMarkup(<Switch id="add-routine" checked={false} />));
